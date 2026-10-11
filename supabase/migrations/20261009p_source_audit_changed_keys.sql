-- Source-mirror audit stores changed keys, 2026-10-09 (Creative Triage).
--
-- The creative, client-success and media source mirrors copy Convex/Meta rows
-- every few minutes. A real change (spend moved, a creative was added) wrote the
-- whole row twice, before and after, 3-30 KB per row: about 88 MB a day.
-- These rows now hold only the keys that changed, one level deep inside the
-- "data" / "raw_data" blob, and metadata.audit_format = 'changed_keys'.
-- Nothing reads full snapshots of these entity types (checked: SQL functions
-- and app code). Human-action audit is unchanged.

CREATE OR REPLACE FUNCTION public.cockpit_audit_changed(p_from jsonb, p_to jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO '' AS $$
 -- Keys of p_from whose value differs in p_to, with the data/raw_data blob
 -- reduced to its own changed keys.
 SELECT coalesce(jsonb_object_agg(k, CASE
   WHEN k IN ('data','raw_data') AND jsonb_typeof(p_from->k)='object' AND jsonb_typeof(p_to->k)='object' THEN
    (SELECT coalesce(jsonb_object_agg(dk, p_from->k->dk), '{}'::jsonb)
       FROM jsonb_object_keys(p_from->k) dk WHERE (p_from->k->dk) IS DISTINCT FROM (p_to->k->dk))
   ELSE p_from->k END), '{}'::jsonb)
 FROM jsonb_object_keys(CASE WHEN jsonb_typeof(p_from)='object' THEN p_from ELSE '{}'::jsonb END) k
 WHERE (p_from->k) IS DISTINCT FROM (p_to->k)
$$;
REVOKE ALL ON FUNCTION public.cockpit_audit_changed(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_audit_changed(jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_media_source_audit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
 IF TG_OP='UPDATE' AND public.cockpit_audit_is_noise(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after",metadata)
  VALUES(TG_OP,TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'source_id',to_jsonb(NEW)->>'table_name'),
   'source-import','media-buyer','supabase',public.cockpit_audit_changed(to_jsonb(OLD),to_jsonb(NEW)),
   public.cockpit_audit_changed(to_jsonb(NEW),to_jsonb(OLD)),jsonb_build_object('audit_format','changed_keys'));
  RETURN NEW;
 END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
 VALUES(TG_OP,TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'source_id',to_jsonb(NEW)->>'table_name'),
  'source-import','media-buyer','supabase',NULL,to_jsonb(NEW));
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_creative_source_audit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
 IF TG_OP='UPDATE' AND public.cockpit_audit_is_noise(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,before,after,metadata)
  VALUES('update','creative_source',NEW.table_name||':'||NEW.source_id,'creative',
   public.cockpit_audit_changed(to_jsonb(OLD),to_jsonb(NEW)),public.cockpit_audit_changed(to_jsonb(NEW),to_jsonb(OLD)),
   jsonb_build_object('audit_format','changed_keys'));
  RETURN NEW;
 END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,before,after)
 VALUES(lower(TG_OP),'creative_source',NEW.table_name||':'||NEW.source_id,'creative',NULL,to_jsonb(NEW));
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_source_audit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
 IF TG_OP='UPDATE' AND public.cockpit_audit_is_noise(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,before,after,metadata)
  VALUES('update','csm_source',NEW.table_name||coalesce(':'||(to_jsonb(NEW)->>'source_id'),''),'client-success',
   public.cockpit_audit_changed(to_jsonb(OLD),to_jsonb(NEW)),public.cockpit_audit_changed(to_jsonb(NEW),to_jsonb(OLD)),
   jsonb_build_object('audit_format','changed_keys'));
  RETURN NEW;
 END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,source_app,before,after)
 VALUES(lower(TG_OP),'csm_source',NEW.table_name||coalesce(':'||(to_jsonb(NEW)->>'source_id'),''),'client-success',NULL,to_jsonb(NEW));
 RETURN NEW;
END $function$;
