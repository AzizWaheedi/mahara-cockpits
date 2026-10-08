-- Separate, review-gated staffing history finalization. The source ZIP and manifest
-- are verified off-database; this RPC pins their frozen identities AND the complete
-- eight private source records by digest. No source content is stored in this migration.
BEGIN;
CREATE OR REPLACE FUNCTION public.cockpit_ceo_staffing_finalize(p_payload jsonb, p_freeze jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 deployment constant text := 'adorable-seahorse-418';
 status_ids constant text[] := ARRAY['t175rzqxvjcf0mr8f8bxfajyk58exyw6','t17afqve7mwxm77hbfzc7yn1358ewzd2','t17bw1gpj3ddmk0tjv9hr49r098exc7a'];
 audit_ids constant text[] := ARRAY['ss72tkaepfaaztbqawj0ms37kn8ex9fv','ss72xg14svsj7sapb1nwqnzh0h8exs8n','ss7956b93544znctktnpvsszjd8ewz1p','ss79d8h6zr1f1w8vpgzmehe10d8exxsy','ss79xbjch2gnnf7b4g4m74w8m18ewhsf'];
 s jsonb; a jsonb; row_status public.cockpit_team_status%ROWTYPE; row_audit public.cockpit_audit_log%ROWTYPE;
 ready boolean;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cockpit_ceo_action'));
 -- Normal CEO writes and the importer use the same advisory lock. Do not lock
 -- the busy, multi-gigabyte audit table against unrelated cockpit writers.
 LOCK TABLE public.cockpit_team_status IN SHARE MODE;
 SELECT history_ready INTO ready FROM public.cockpit_team_status_state WHERE id=true FOR UPDATE;
 IF ready IS NULL THEN RAISE EXCEPTION 'Staffing readiness state absent'; END IF;
 IF pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR pg_catalog.octet_length(p_payload::text)>100000
    OR p_payload->>'source_sha256' IS DISTINCT FROM 'bd4776356d073380745108ca10f2c19dbb8b194eafd2839d3d277d317c3ff3a8'
    OR p_payload->>'deployment' IS DISTINCT FROM deployment
    OR pg_catalog.jsonb_typeof(p_payload->'statuses') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_typeof(p_payload->'audits') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(p_payload->'statuses')<>3 OR pg_catalog.jsonb_array_length(p_payload->'audits')<>5
    OR p_freeze IS DISTINCT FROM pg_catalog.jsonb_build_object(
      'current_sha256','bd4776356d073380745108ca10f2c19dbb8b194eafd2839d3d277d317c3ff3a8',
      'prior_sha256','75941c6d9015053af9ae2abde87fe2605f363927935e45582da80a265888ac5e',
      'deployment',deployment,'status_count',3,'audit_count',40,'staffing_audit_count',5,'source_rows_equal',true) THEN
   RAISE EXCEPTION 'Frozen staffing source evidence missing or changed';
 END IF;
 -- Immutable, record-level fingerprints generated from the private verified archive
 -- using PostgreSQL jsonb::text. A claimed ZIP SHA alone is not proof of row content.
 IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payload->'statuses') x
    WHERE (x->>'_id',pg_catalog.md5(x::text)) NOT IN (
      ('t175rzqxvjcf0mr8f8bxfajyk58exyw6','d9a5d0e556cda4b3c72a467478360dc8'),
      ('t17afqve7mwxm77hbfzc7yn1358ewzd2','0fc47992cea29adc6c9a2a9a776730a7'),
      ('t17bw1gpj3ddmk0tjv9hr49r098exc7a','ad18da21e9a4a5b1587166dd2607083b'))
 ) OR EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payload->'audits') x
    WHERE (x->>'_id',pg_catalog.md5(x::text)) NOT IN (
      ('ss72tkaepfaaztbqawj0ms37kn8ex9fv','d89cd24f8de5cf0cb993f8f1652007fc'),
      ('ss72xg14svsj7sapb1nwqnzh0h8exs8n','ad46fbada3b7662461266447b53c2f7b'),
      ('ss7956b93544znctktnpvsszjd8ewz1p','cb52377cc14c375516ff3b5b6043c2bf'),
      ('ss79d8h6zr1f1w8vpgzmehe10d8exxsy','984896eaffbbe8e62fd4af9fc368f69e'),
      ('ss79xbjch2gnnf7b4g4m74w8m18ewhsf','73c5cb8e03ed4ba395b4362f23ee39cf'))
 ) OR (SELECT pg_catalog.array_agg(x->>'_id' ORDER BY x->>'_id') FROM pg_catalog.jsonb_array_elements(p_payload->'statuses') x)
      IS DISTINCT FROM (SELECT pg_catalog.array_agg(x ORDER BY x) FROM pg_catalog.unnest(status_ids) x)
   OR (SELECT pg_catalog.array_agg(x->>'_id' ORDER BY x->>'_id') FROM pg_catalog.jsonb_array_elements(p_payload->'audits') x)
      IS DISTINCT FROM (SELECT pg_catalog.array_agg(x ORDER BY x) FROM pg_catalog.unnest(audit_ids) x)
 THEN RAISE EXCEPTION 'Frozen staffing records differ'; END IF;
 IF (SELECT pg_catalog.count(*) FROM public.cockpit_team_status)<>3
    OR (SELECT pg_catalog.count(*) FROM public.cockpit_audit_log
        WHERE entity_type IN ('ceoTeamStatus','cockpit_team_status'))<>5 THEN
   RAISE EXCEPTION 'Contradictory or incomplete staffing history';
 END IF;
 FOR s IN SELECT value FROM pg_catalog.jsonb_array_elements(p_payload->'statuses') LOOP
   SELECT * INTO row_status FROM public.cockpit_team_status WHERE source_id=s->>'_id';
   IF NOT FOUND OR row_status.source_deployment IS DISTINCT FROM deployment
      OR row_status.source_record IS DISTINCT FROM s OR row_status.person_key IS DISTINCT FROM s->>'personKey'
      OR row_status.status IS DISTINCT FROM s->>'status' OR row_status.since IS DISTINCT FROM (s->>'since')::date
      OR row_status.note IS DISTINCT FROM s->>'note' OR row_status.set_by IS DISTINCT FROM s->>'setBy'
      OR row_status.set_at IS DISTINCT FROM pg_catalog.to_timestamp((s->>'setAt')::numeric/1000) THEN
     RAISE EXCEPTION 'Imported staffing status differs from frozen source';
   END IF;
 END LOOP;
 FOR a IN SELECT value FROM pg_catalog.jsonb_array_elements(p_payload->'audits') LOOP
   SELECT * INTO row_audit FROM public.cockpit_audit_log
    WHERE source_system='convex' AND metadata->>'source_table'='ceoAudit'
      AND metadata->>'source_deployment'=deployment AND metadata->>'source_id'=a->>'_id';
   IF NOT FOUND OR row_audit.action IS DISTINCT FROM a->>'action'
      OR row_audit.entity_type IS DISTINCT FROM 'cockpit_team_status' OR row_audit.entity_id IS DISTINCT FROM a->>'rowId'
      OR row_audit.actor_email IS DISTINCT FROM a->>'by' OR row_audit.source_app IS DISTINCT FROM 'media-buyer'
      OR row_audit.before IS DISTINCT FROM a->'before' OR row_audit.after IS DISTINCT FROM a->'after'
      OR row_audit.created_at IS DISTINCT FROM pg_catalog.to_timestamp((a->>'at')::numeric/1000)
      OR row_audit.metadata IS DISTINCT FROM pg_catalog.jsonb_build_object(
        'source_table','ceoAudit','source_deployment',deployment,'source_id',a->>'_id','source_record',a) THEN
     RAISE EXCEPTION 'Imported staffing audit differs from frozen source';
   END IF;
 END LOOP;
 -- Full source records above also pin every audit after-state; verify latest audit
 -- agrees with each final status, not merely a shared ID.
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payload->'statuses') src_status
    WHERE (SELECT src_audit->'after' FROM pg_catalog.jsonb_array_elements(p_payload->'audits') src_audit
           WHERE src_audit->>'rowId'=src_status->>'personKey' ORDER BY (src_audit->>'at')::numeric DESC LIMIT 1)
       IS DISTINCT FROM (src_status - '_id' - '_creationTime')) THEN
   RAISE EXCEPTION 'Final status has no matching original audit';
 END IF;
 IF NOT ready THEN UPDATE public.cockpit_team_status_state SET history_ready=true WHERE id=true; END IF;
 RETURN pg_catalog.jsonb_build_object('history_ready',true,'statuses',3,'source_audits',5);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_staffing_finalize(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_staffing_finalize(jsonb,jsonb) TO service_role;
COMMIT;
