-- Staffing-only one-shot restore. Deploy only after human review; no full inventory.
-- Requires existing status columns/source unique index and immutable audit/source unique index.
BEGIN;
CREATE OR REPLACE FUNCTION public.cockpit_ceo_staffing_import(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 s jsonb; a jsonb; old_row public.cockpit_team_status%ROWTYPE; old_audit public.cockpit_audit_log%ROWTYPE;
 status_ids text[] := ARRAY['t175rzqxvjcf0mr8f8bxfajyk58exyw6','t17afqve7mwxm77hbfzc7yn1358ewzd2','t17bw1gpj3ddmk0tjv9hr49r098exc7a'];
 audit_ids text[] := ARRAY['ss72tkaepfaaztbqawj0ms37kn8ex9fv','ss72xg14svsj7sapb1nwqnzh0h8exs8n','ss7956b93544znctktnpvsszjd8ewz1p','ss79d8h6zr1f1w8vpgzmehe10d8exxsy','ss79xbjch2gnnf7b4g4m74w8m18ewhsf'];
 deployment constant text := 'adorable-seahorse-418';
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'Service role required';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('cockpit_ceo_action'));
 -- CEO action advisory lock and the locked readiness row serialize this one-shot import;
 -- unique source indexes reject a concurrent duplicate without blocking all audit writers.
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename='cockpit_audit_log' AND indexname='cockpit_original_audit_source_identity')
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename='cockpit_team_status' AND indexname='cockpit_team_status_source_identity') THEN
   RAISE EXCEPTION 'Source identity constraints missing';
 END IF;
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>100000
    OR p_payload->>'source_sha256' IS DISTINCT FROM 'bd4776356d073380745108ca10f2c19dbb8b194eafd2839d3d277d317c3ff3a8'
    OR p_payload->>'deployment' IS DISTINCT FROM deployment
    OR jsonb_typeof(p_payload->'statuses') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload->'audits') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload->'statuses')<>3 OR jsonb_array_length(p_payload->'audits')<>5 THEN
   RAISE EXCEPTION 'Unapproved or incomplete staffing source';
 END IF;
 IF (SELECT array_agg(x->>'_id' ORDER BY x->>'_id') FROM jsonb_array_elements(p_payload->'statuses') x) IS DISTINCT FROM
    (SELECT array_agg(x ORDER BY x) FROM unnest(status_ids) x)
    OR (SELECT array_agg(x->>'_id' ORDER BY x->>'_id') FROM jsonb_array_elements(p_payload->'audits') x) IS DISTINCT FROM
    (SELECT array_agg(x ORDER BY x) FROM unnest(audit_ids) x) THEN
   RAISE EXCEPTION 'Source identities changed';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cockpit_team_status_state WHERE id=true AND history_ready=false FOR UPDATE) THEN
   RAISE EXCEPTION 'Staffing readiness state is absent or already open';
 END IF;
 IF EXISTS(SELECT 1 FROM public.cockpit_team_status WHERE source_id IS NULL OR source_deployment IS DISTINCT FROM deployment OR source_id<>ALL(status_ids))
    OR EXISTS(SELECT 1 FROM public.cockpit_audit_log WHERE source_system='convex' AND metadata->>'source_table'='ceoAudit' AND entity_type='cockpit_team_status'
               AND (metadata->>'source_deployment' IS DISTINCT FROM deployment OR metadata->>'source_id'<>ALL(audit_ids))) THEN
   RAISE EXCEPTION 'Conflicting pre-existing staffing history';
 END IF;
 IF (SELECT count(DISTINCT x->>'personKey') FROM jsonb_array_elements(p_payload->'statuses') x)<>3 THEN RAISE EXCEPTION 'Duplicate person key'; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(p_payload->'audits') LOOP
   IF a->>'table' IS DISTINCT FROM 'ceoTeamStatus' OR a->>'action' IS DISTINCT FROM 'teamStatus.set'
      OR nullif(a->>'by','') IS NULL OR nullif(a->>'rowId','') IS NULL OR jsonb_typeof(a->'after') IS DISTINCT FROM 'object'
      OR a->'after'->>'personKey' IS DISTINCT FROM a->>'rowId'
      OR a->'after'->>'setBy' IS DISTINCT FROM a->>'by'
      OR a->'after'->>'setAt' IS DISTINCT FROM a->>'at'
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'statuses') x WHERE x->>'personKey'=a->>'rowId') THEN
     RAISE EXCEPTION 'Unmatched or malformed source audit';
   END IF;
 END LOOP;
 FOR s IN SELECT value FROM jsonb_array_elements(p_payload->'statuses') LOOP
   IF nullif(s->>'personKey','') IS NULL OR s->>'status' NOT IN('active','paused','left') OR nullif(s->>'setBy','') IS NULL
      OR s->>'since' !~ '^\d{4}-\d{2}-\d{2}$' OR s->>'setAt' !~ '^\d{13}(\.\d+)?$'
      OR (s ? 'note' AND jsonb_typeof(s->'note') NOT IN ('string','null'))
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'audits') x WHERE x->>'rowId'=s->>'personKey')
      OR (SELECT x->'after' FROM jsonb_array_elements(p_payload->'audits') x WHERE x->>'rowId'=s->>'personKey' ORDER BY (x->>'at')::numeric DESC LIMIT 1)
          IS DISTINCT FROM (s - '_id' - '_creationTime') THEN
      RAISE EXCEPTION 'Source status lacks matching final audit';
   END IF;
   SELECT * INTO old_row FROM public.cockpit_team_status WHERE person_key=s->>'personKey';
   IF FOUND THEN
      IF old_row.source_deployment IS DISTINCT FROM deployment OR old_row.source_id IS DISTINCT FROM s->>'_id'
         OR old_row.source_record IS DISTINCT FROM s OR old_row.status IS DISTINCT FROM s->>'status'
         OR old_row.since IS DISTINCT FROM (s->>'since')::date OR old_row.note IS DISTINCT FROM s->>'note'
         OR old_row.set_by IS DISTINCT FROM s->>'setBy' OR old_row.set_at IS DISTINCT FROM to_timestamp((s->>'setAt')::numeric/1000) THEN
        RAISE EXCEPTION 'Existing staffing row differs';
      END IF;
   ELSE
      INSERT INTO public.cockpit_team_status(person_key,status,since,note,set_by,set_at,source_deployment,source_id,source_record)
      VALUES(s->>'personKey',s->>'status',(s->>'since')::date,s->>'note',s->>'setBy',to_timestamp((s->>'setAt')::numeric/1000),deployment,s->>'_id',s);
   END IF;
 END LOOP;
 FOR a IN SELECT value FROM jsonb_array_elements(p_payload->'audits') LOOP
   SELECT * INTO old_audit FROM public.cockpit_audit_log WHERE source_system='convex' AND metadata->>'source_table'='ceoAudit'
      AND metadata->>'source_deployment'=deployment AND metadata->>'source_id'=a->>'_id';
   IF FOUND THEN
      IF old_audit.action IS DISTINCT FROM a->>'action' OR old_audit.entity_type IS DISTINCT FROM 'cockpit_team_status'
         OR old_audit.entity_id IS DISTINCT FROM a->>'rowId' OR old_audit.actor_email IS DISTINCT FROM a->>'by'
         OR old_audit.source_app IS DISTINCT FROM 'media-buyer' OR old_audit.before IS DISTINCT FROM a->'before'
         OR old_audit.after IS DISTINCT FROM a->'after' OR old_audit.created_at IS DISTINCT FROM to_timestamp((a->>'at')::numeric/1000)
         OR old_audit.metadata IS DISTINCT FROM jsonb_build_object('source_table','ceoAudit','source_deployment',deployment,'source_id',a->>'_id','source_record',a) THEN
        RAISE EXCEPTION 'Existing source audit differs';
      END IF;
   ELSE
      INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,created_at,metadata)
      VALUES(a->>'action','cockpit_team_status',a->>'rowId',a->>'by','media-buyer','convex',a->'before',a->'after',to_timestamp((a->>'at')::numeric/1000),
             jsonb_build_object('source_table','ceoAudit','source_deployment',deployment,'source_id',a->>'_id','source_record',a));
   END IF;
 END LOOP;
 IF (SELECT count(*) FROM public.cockpit_team_status WHERE source_deployment=deployment AND source_id=ANY(status_ids))<>3
    OR (SELECT count(*) FROM public.cockpit_audit_log WHERE source_system='convex' AND metadata->>'source_table'='ceoAudit'
       AND metadata->>'source_deployment'=deployment AND metadata->>'source_id'=ANY(audit_ids))<>5 THEN
   RAISE EXCEPTION 'Incomplete staffing import';
 END IF;
 RETURN jsonb_build_object('statuses',3,'source_audits',5,'history_ready',false);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_staffing_import(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_staffing_import(jsonb) TO service_role;
COMMIT;
