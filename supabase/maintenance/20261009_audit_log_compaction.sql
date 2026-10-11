-- One-off cockpit_audit_log compaction, 2026-10-09 (Creative Triage bldgtotkfmhoxmlzowdx).
-- Record of what was run, in order. Run by Claude on Muhammed's instruction
-- ("finish it end to end"). Not a migration: it moves data once.
--
-- Before: 4,180,418 rows, 5.2 GB (82% of the 6.4 GB database).
-- Kept as-is: every human action, every Convex import (source_system='convex'),
--   finance, staffing, people, checks, drafts, and every real data change.
-- Dropped: machine re-saves that changed nothing or only a sync timestamp or a
--   rotating CDN image link (same rule the triggers apply since 20261009m/o):
--   about 3.85M WhatsApp no-op rows and ~230k sync heartbeats.
-- Compacted in place (rows kept, ids and times kept, metadata says so):
--   * 177 cockpit_native_media_runs rows that embedded the full ~2 MB plan and
--     the lease token: plan/receipt replaced by references, plan_sha kept.
--   * real-change rows of the three source mirrors: changed keys only
--     (metadata.audit_format='changed_keys'), the format new rows use.
--
-- Method (no long lock, space returned immediately):
--   1. Copy kept rows into cockpit_audit_log_compact in time chunks.
--   2. Verify counts and byte-equality of untouched rows against the original.
--   3. Short swap under ACCESS EXCLUSIVE: copy the last delta, rename tables,
--      re-attach the immutability trigger, RLS policy and grants.
--   4. Copy any straggler insert that queued on the old table, then drop it.

-- 1. Helpers (dropped at the end) -------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_audit_slim_run(x jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE WHEN x IS NULL OR jsonb_typeof(x)<>'object' THEN x ELSE jsonb_build_object(
  'run_id',x->'run_id','status',x->'status','lease_expires_at',x->'lease_expires_at',
  'published_at',x->'published_at','plan_sha',x->'plan_sha',
  'plan_ref',CASE WHEN x ? 'plan_ref' THEN x->'plan_ref'
    WHEN coalesce(x->'plan','null'::jsonb)='null'::jsonb THEN 'null'::jsonb
    ELSE jsonb_build_object('schema','public','table','cockpit_native_media_runs','column','plan',
      'run_id',x->'run_id','plan_sha',x->'plan_sha') END,
  'receipt_ref',CASE WHEN x ? 'receipt_ref' THEN x->'receipt_ref'
    WHEN coalesce(x->'receipt','null'::jsonb)='null'::jsonb THEN 'null'::jsonb
    ELSE jsonb_build_object('schema','public','table','cockpit_native_media_runs','column','receipt',
      'run_id',x->'run_id','plan_sha',x->'plan_sha') END,
  'error',x->'error','created_at',x->'created_at','updated_at',x->'updated_at') END
$$;

-- Classification shared by the copy and the verification.
CREATE OR REPLACE FUNCTION public.cockpit_audit_compaction_class(a public.cockpit_audit_log)
RETURNS text LANGUAGE sql STABLE SET search_path TO '' AS $$
 SELECT CASE
  WHEN lower(a.action)='update' AND a.before IS NOT NULL AND a.after IS NOT NULL
   AND a.entity_type IN ('wa_messages','wa_threads','wa_state','creative_source','creative_source_state',
     'csm_source','cockpit_media_sources','cockpit_media_source_state','cockpit_media_daily_stats',
     'cockpit_media_booking_events','cockpit_media_feed_state','cockpit_native_stills','cockpit_runtime_imports')
   AND public.cockpit_audit_is_noise(a.before,a.after) THEN 'drop_heartbeat'
  WHEN a.action='native.publish' AND jsonb_typeof(a.before)='object' AND jsonb_typeof(a.after)='object'
   AND (a.before - ARRAY['id','created_at','updated_at','synced_at','raw_data','thumbnail_url']::text[])
       IS NOT DISTINCT FROM (a.after - ARRAY['id','created_at','updated_at','synced_at','raw_data','thumbnail_url']::text[])
   AND ((a.before->'raw_data')-ARRAY['syncedAt','thumbnailUrl','thumbUrl','imageUrl','previewUrl'])
       IS NOT DISTINCT FROM ((a.after->'raw_data')-ARRAY['syncedAt','thumbnailUrl','thumbUrl','imageUrl','previewUrl'])
   THEN 'drop_cdn_link'
  WHEN a.entity_type='cockpit_native_media_runs'
   AND (coalesce(a.before ? 'plan',false) OR coalesce(a.after ? 'plan',false)
     OR coalesce(a.before ? 'lease_token',false) OR coalesce(a.after ? 'lease_token',false)) THEN 'slim_run'
  WHEN a.entity_type IN ('creative_source','csm_source','cockpit_media_sources') AND lower(a.action)='update'
   AND a.before IS NOT NULL AND a.after IS NOT NULL
   AND coalesce(a.metadata->>'audit_format','')<>'changed_keys' THEN 'changed_keys'
  ELSE 'keep' END
$$;

-- 2. Target table: same columns, defaults and storage; indexes after the load.
CREATE TABLE IF NOT EXISTS public.cockpit_audit_log_compact
 (LIKE public.cockpit_audit_log INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE INCLUDING COMPRESSION);
ALTER TABLE public.cockpit_audit_log_compact ADD CONSTRAINT cockpit_audit_log_compact_pkey PRIMARY KEY (id);
ALTER TABLE public.cockpit_audit_log_compact ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_audit_log_compact FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cockpit_audit_compaction_copy(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE r jsonb;
BEGIN
 WITH src AS (
  SELECT a.*, public.cockpit_audit_compaction_class(a) AS cls
  FROM public.cockpit_audit_log a WHERE a.created_at >= p_from AND a.created_at < p_to),
 ins AS (
  INSERT INTO public.cockpit_audit_log_compact(id,action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata,created_at)
  SELECT id,action,entity_type,entity_id,actor_email,source_app,source_system,
   CASE cls WHEN 'slim_run' THEN public.cockpit_audit_slim_run(before)
            WHEN 'changed_keys' THEN public.cockpit_audit_changed(before,after) ELSE before END,
   CASE cls WHEN 'slim_run' THEN public.cockpit_audit_slim_run(after)
            WHEN 'changed_keys' THEN public.cockpit_audit_changed(after,before) ELSE after END,
   CASE cls WHEN 'slim_run' THEN metadata||jsonb_build_object('compacted_at','2026-10-09',
              'compaction','plan and receipt bodies replaced by references; plan_sha kept; lease token removed')
            WHEN 'changed_keys' THEN metadata||jsonb_build_object('audit_format','changed_keys','compacted_at','2026-10-09')
            ELSE metadata END,
   created_at
  FROM src WHERE cls IN ('keep','slim_run','changed_keys')
  ON CONFLICT (id) DO NOTHING RETURNING 1)
 SELECT jsonb_build_object('from',p_from,'to',p_to,
   'scanned',(SELECT count(*) FROM src),
   'copied',(SELECT count(*) FROM ins),
   'classes',(SELECT jsonb_object_agg(cls,n) FROM (SELECT cls,count(*) n FROM src GROUP BY cls) c)) INTO r;
 RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.cockpit_audit_compaction_copy(timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;

-- 3. Copy in chunks of at most ~400k rows (see session record for the ranges).
-- SELECT public.cockpit_audit_compaction_copy(<from>, <to>);

-- 4. Verify (all must hold before the swap):
--   * compact rows = original rows with class keep/slim_run/changed_keys
--   * keep-class rows are byte-identical (row equality joined on id)
--   * Convex-import, manual-payment and team-status rows: identical counts and hashes

-- 5. Swap (one short transaction).
-- BEGIN;
-- SET LOCAL lock_timeout = '15s';
-- LOCK TABLE public.cockpit_audit_log IN ACCESS EXCLUSIVE MODE;
-- SELECT public.cockpit_audit_compaction_copy(<copy cutoff> - interval '1 hour', 'infinity');
-- ALTER TABLE public.cockpit_audit_log RENAME TO cockpit_audit_log_precompaction;
-- ALTER TABLE public.cockpit_audit_log_compact RENAME TO cockpit_audit_log;
-- CREATE TRIGGER trg_cockpit_audit_log_immutable BEFORE DELETE OR UPDATE ON public.cockpit_audit_log
--  FOR EACH ROW EXECUTE FUNCTION public.cockpit_audit_log_immutable();
-- CREATE POLICY cockpit_audit_log_select_admin ON public.cockpit_audit_log FOR SELECT TO authenticated
--  USING (public.cockpit_has_role('admin') OR public.cockpit_is_ceo());
-- GRANT SELECT ON public.cockpit_audit_log TO authenticated;
-- GRANT ALL ON public.cockpit_audit_log TO service_role;
-- COMMIT;
--
-- 6. Stragglers and drop (one short transaction).
-- BEGIN;
-- LOCK TABLE public.cockpit_audit_log_precompaction IN ACCESS EXCLUSIVE MODE;
-- INSERT INTO public.cockpit_audit_log SELECT p.* FROM public.cockpit_audit_log_precompaction p
--  WHERE p.created_at >= <copy cutoff> - interval '1 hour'
--    AND public.cockpit_audit_compaction_class(p) IN ('keep','slim_run','changed_keys')
--  ON CONFLICT (id) DO NOTHING;
-- DROP TABLE public.cockpit_audit_log_precompaction;
-- COMMIT;
-- Then rename indexes and the primary key back to their original names, ANALYZE,
-- and drop the helpers above.
