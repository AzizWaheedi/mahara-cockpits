-- Backend hygiene, 2026-10-09 (Creative Triage bldgtotkfmhoxmlzowdx).
--
-- Why: machine syncs re-save rows every few minutes, and the audit triggers
-- copied a full before/after snapshot for every re-save, even when nothing
-- changed. cockpit_audit_log reached 4.18M rows / 5.2 GB in 17 days; 3.85M of
-- them were WhatsApp re-saves with before = after. Every real change is still
-- audited after this migration; only re-saves that change nothing, or change
-- only a sync timestamp or a rotating CDN image link, are skipped.
--
-- Also: the native monitor answered in 31 s (API timeout, HTTP 500 every few
-- minutes) because it sorted the whole provider ledger through to_jsonb and
-- hashed every ledger row once per check. It now reads an index.
--
-- The one-off audit-log compaction and the retention schedule are recorded in
-- supabase/maintenance/20261009_audit_log_compaction.sql.

BEGIN;

-- 1. One definition of "nothing real changed" -------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_audit_strip_noise(p jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO '' AS $$
 SELECT CASE WHEN jsonb_typeof(p) IS DISTINCT FROM 'object' THEN p ELSE
  (p - ARRAY['updated_at','synced_at','imported_at','source_snapshot_at'])
  || CASE WHEN jsonb_typeof(p->'data')='object' THEN jsonb_build_object('data',
       (p->'data') - ARRAY['syncedAt','thumbUrl','thumbnailUrl','imageUrl','previewUrl',
        'statsScannedAt','formCheckedAt','lastSeenAt','performanceSyncedAt','at'])
     ELSE '{}'::jsonb END
 END
$$;

CREATE OR REPLACE FUNCTION public.cockpit_audit_is_noise(p_old jsonb, p_new jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO '' AS $$
 SELECT p_old IS NOT NULL AND p_new IS NOT NULL
  AND public.cockpit_audit_strip_noise(p_old) IS NOT DISTINCT FROM public.cockpit_audit_strip_noise(p_new)
$$;

REVOKE ALL ON FUNCTION public.cockpit_audit_strip_noise(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cockpit_audit_is_noise(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_audit_strip_noise(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_audit_is_noise(jsonb, jsonb) TO service_role;

-- 2. Audit triggers skip re-saves that change nothing -----------------------
-- Bodies are unchanged apart from the first guard line.

CREATE OR REPLACE FUNCTION public.cockpit_media_native_audit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
 IF TG_OP='UPDATE' AND public.cockpit_audit_is_noise(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after",metadata)
 VALUES(lower(TG_OP),TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'id',to_jsonb(OLD)->>'id',to_jsonb(NEW)->>'actor_id','calendar-config'),
 coalesce((SELECT email FROM auth.users WHERE id=auth.uid()),'media-native-worker'),coalesce(to_jsonb(NEW)->>'calendar_app',to_jsonb(OLD)->>'calendar_app',to_jsonb(NEW)->>'app',to_jsonb(OLD)->>'app','media-buyer'),'supabase',
 CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END,jsonb_build_object('actor',auth.uid()));
 RETURN coalesce(NEW,OLD);
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_native_audit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE old_snapshot jsonb; new_snapshot jsonb; entity_id text;
BEGIN
 IF TG_TABLE_NAME='cockpit_native_media_runs' THEN
  entity_id:=coalesce(NEW.run_id::text,OLD.run_id::text);
  IF TG_OP<>'INSERT' THEN
   old_snapshot:=jsonb_build_object(
    'run_id',OLD.run_id,'status',OLD.status,'lease_expires_at',OLD.lease_expires_at,
    'published_at',OLD.published_at,'plan_sha',OLD.plan_sha,
    'plan_ref',CASE WHEN OLD.plan IS NULL THEN NULL ELSE jsonb_build_object(
     'schema','public','table','cockpit_native_media_runs','column','plan',
     'run_id',OLD.run_id,'plan_sha',OLD.plan_sha) END,
    'receipt_ref',CASE WHEN OLD.receipt IS NULL THEN NULL ELSE jsonb_build_object(
     'schema','public','table','cockpit_native_media_runs','column','receipt',
     'run_id',OLD.run_id,'plan_sha',OLD.plan_sha) END,
    'error',OLD.error,'created_at',OLD.created_at,'updated_at',OLD.updated_at);
  END IF;
  IF TG_OP<>'DELETE' THEN
   new_snapshot:=jsonb_build_object(
    'run_id',NEW.run_id,'status',NEW.status,'lease_expires_at',NEW.lease_expires_at,
    'published_at',NEW.published_at,'plan_sha',NEW.plan_sha,
    'plan_ref',CASE WHEN NEW.plan IS NULL THEN NULL ELSE jsonb_build_object(
     'schema','public','table','cockpit_native_media_runs','column','plan',
     'run_id',NEW.run_id,'plan_sha',NEW.plan_sha) END,
    'receipt_ref',CASE WHEN NEW.receipt IS NULL THEN NULL ELSE jsonb_build_object(
     'schema','public','table','cockpit_native_media_runs','column','receipt',
     'run_id',NEW.run_id,'plan_sha',NEW.plan_sha) END,
    'error',NEW.error,'created_at',NEW.created_at,'updated_at',NEW.updated_at);
  END IF;
 ELSE
  entity_id:=coalesce(to_jsonb(NEW)->>'run_id',to_jsonb(NEW)->>'key',to_jsonb(OLD)->>'source_id');
  IF TG_OP<>'INSERT' THEN old_snapshot:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_snapshot:=to_jsonb(NEW); END IF;
 END IF;
 IF TG_OP='UPDATE' AND public.cockpit_audit_is_noise(old_snapshot,new_snapshot) THEN RETURN NEW; END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after)
 VALUES(lower(TG_OP),TG_TABLE_NAME,entity_id,
  'native-feed','media-buyer','supabase',old_snapshot,new_snapshot);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_media_feed_audit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
 IF TG_OP='UPDATE' AND public.cockpit_audit_is_noise(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
 VALUES(TG_OP,TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'source_id',to_jsonb(NEW)->>'feed'),
  'media-feed-import','media-buyer','supabase',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_media_source_audit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
 IF TG_OP='UPDATE' AND public.cockpit_audit_is_noise(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
 VALUES(TG_OP,TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'source_id',to_jsonb(NEW)->>'table_name'),
  'source-import','media-buyer','supabase',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_creative_source_audit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
 IF TG_OP='UPDATE' AND public.cockpit_audit_is_noise(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,before,after)
 VALUES(lower(TG_OP),'creative_source',NEW.table_name||':'||NEW.source_id,'creative',
  CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_creative_source_state_audit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
 IF TG_OP='UPDATE' AND public.cockpit_audit_is_noise(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,before,after)
 VALUES(lower(TG_OP),'creative_source_state',NEW.table_name,'creative_import',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_source_audit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
 IF TG_OP='UPDATE' AND public.cockpit_audit_is_noise(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,before,after)
 VALUES(lower(TG_OP),'csm_source',NEW.table_name||coalesce(':'||(to_jsonb(NEW)->>'source_id'),''),'client-success',
  CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $function$;

-- The 2026-10-06 scoped install added a second copy of the canonical
-- cockpit_csm_state_audit trigger (20260927v_csm_read_models.sql), so every
-- source-state change was written twice.
DROP TRIGGER IF EXISTS cockpit_csm_source_state_scoped_install_audit ON public.cockpit_csm_source_state;

-- 3. Provider ledgers: index the "latest receipt per resource" read ----------

CREATE INDEX IF NOT EXISTS cockpit_media_provider_health_latest_idx
 ON public.cockpit_media_provider_health (provider, resource, created_at DESC, id DESC)
 INCLUDE (phase, http_status, method) WHERE phase <> 'intent';
CREATE INDEX IF NOT EXISTS cockpit_ceo_provider_health_latest_idx
 ON public.cockpit_ceo_provider_health (provider, resource, created_at DESC, id DESC)
 INCLUDE (phase, http_status, method) WHERE phase <> 'intent';
CREATE INDEX IF NOT EXISTS cockpit_csm_provider_health_latest_idx
 ON public.cockpit_csm_provider_health (provider, resource, created_at DESC, id DESC)
 INCLUDE (phase, http_status, method) WHERE phase <> 'intent';
CREATE INDEX IF NOT EXISTS cockpit_media_provider_health_created_idx
 ON public.cockpit_media_provider_health (created_at);
CREATE INDEX IF NOT EXISTS cockpit_ceo_provider_health_created_idx
 ON public.cockpit_ceo_provider_health (created_at);

-- 4. Security: close anonymous entry points that only servers use ----------

-- Called only by the client-config-sync Edge Function with the service key.
REVOKE EXECUTE ON FUNCTION public.refresh_client_ad_accounts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_client_ad_accounts() TO service_role;

-- Trigger functions fire without EXECUTE; nobody should call them over RPC.
DO $$
DECLARE f regprocedure;
BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prorettype='trigger'::regtype
    AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))
 LOOP
  EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
 END LOOP;
END $$;

COMMIT;
