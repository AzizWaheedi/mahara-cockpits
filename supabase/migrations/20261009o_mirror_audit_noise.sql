-- Mirror audit noise, 2026-10-09 (Creative Triage bldgtotkfmhoxmlzowdx).
--
-- cockpit_native_mirrors wrote a native.publish audit row for every ad and
-- campaign on every 15-minute publish (3,649 rows a day). The only change was
-- the rotating Facebook CDN thumbnail link (thumbnail_url, raw_data.thumbnailUrl)
-- and syncedAt. Measured on the last 24 h of rows, the rule below still logs
-- the 153 real changes and skips the rest.
--
-- The function is long and owned by the native-mirror work, so this edits the
-- one comparison in place and refuses to run if the text is not found exactly
-- once. Re-running is a no-op.

DO $migration$
DECLARE
 def text;
 old_rule constant text := $old$IF old IS NULL OR (old - ARRAY['id','created_at','updated_at','synced_at','raw_data']::text[]) IS DISTINCT FROM (proposed - ARRAY['id','created_at','updated_at','synced_at','raw_data']::text[])
    OR ((old->'raw_data')-'syncedAt'::text) IS DISTINCT FROM ((proposed->'raw_data')-'syncedAt'::text) THEN$old$;
 new_rule constant text := $new$IF old IS NULL OR (old - ARRAY['id','created_at','updated_at','synced_at','raw_data','thumbnail_url']::text[]) IS DISTINCT FROM (proposed - ARRAY['id','created_at','updated_at','synced_at','raw_data','thumbnail_url']::text[])
    OR ((old->'raw_data')-ARRAY['syncedAt','thumbnailUrl','thumbUrl','imageUrl','previewUrl']) IS DISTINCT FROM ((proposed->'raw_data')-ARRAY['syncedAt','thumbnailUrl','thumbUrl','imageUrl','previewUrl']) THEN$new$;
 hits integer;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='cockpit_native_mirrors';
 IF def IS NULL THEN RAISE EXCEPTION 'cockpit_native_mirrors not found'; END IF;
 IF strpos(def,new_rule)>0 THEN RAISE NOTICE 'Already applied'; RETURN; END IF;
 hits := (length(def)-length(replace(def,old_rule,'')))/length(old_rule);
 IF hits<>1 THEN RAISE EXCEPTION 'Expected the comparison once in cockpit_native_mirrors, found %', hits; END IF;
 EXECUTE replace(def,old_rule,new_rule);
END $migration$;
