BEGIN;
CREATE OR REPLACE FUNCTION public.cockpit_native_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after)
 VALUES(lower(TG_OP),TG_TABLE_NAME,entity_id,
  'native-feed','media-buyer','supabase',old_snapshot,new_snapshot);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
COMMIT;
