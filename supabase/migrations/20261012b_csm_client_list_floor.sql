-- The native feed cannot wipe the client list (2026-10-12).
--
-- cockpit_native_media_publish replaces csm.clients and csm.clientProfiles in
-- full: rows missing from the new list are deleted. Nothing checked the size,
-- so a valid but empty ClickUp answer would have removed every client from the
-- client success cockpit. Publishing ends by writing each table's new
-- row_count, so this trigger refuses that write, and with it the whole publish,
-- when either list falls below 60% of what is there now. Small lists (under 10
-- rows) are not checked.
--
-- A real board cleanup is allowed once: run
--   select cockpit_native_allow_shrink('clients', 'why');
-- (and 'clientProfiles') as the service role. The allowance lasts two hours,
-- is used up by the first shrink, and both steps leave an audit row.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cockpit_native_shrink_allowances(
  table_name text PRIMARY KEY CHECK (table_name IN ('clients','clientProfiles')),
  allow_until timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  created_by text NOT NULL DEFAULT current_user,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cockpit_native_shrink_allowances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_native_shrink_allowances FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.cockpit_native_shrink_allowances TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_native_allow_shrink(p_table text, p_reason text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE until timestamptz:=now()+interval '2 hours';
BEGIN
 IF p_table NOT IN ('clients','clientProfiles') THEN RAISE EXCEPTION 'Only clients or clientProfiles can be allowed to shrink'; END IF;
 IF length(btrim(coalesce(p_reason,''))) < 5 THEN RAISE EXCEPTION 'Say why the client list is allowed to shrink'; END IF;
 INSERT INTO public.cockpit_native_shrink_allowances(table_name,allow_until,reason) VALUES(p_table,until,btrim(p_reason))
 ON CONFLICT (table_name) DO UPDATE SET allow_until=excluded.allow_until,reason=excluded.reason,created_by=excluded.created_by,created_at=now();
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_system,after)
 VALUES('ALLOW_SHRINK','cockpit_csm_source_state',p_table,current_user,'supabase',jsonb_build_object('allow_until',until,'reason',btrim(p_reason)));
 RETURN until;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_native_allow_shrink(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_native_allow_shrink(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.cockpit_csm_client_list_floor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE allowance public.cockpit_native_shrink_allowances;
BEGIN
 IF NEW.table_name NOT IN ('clients','clientProfiles') OR coalesce(OLD.row_count,0) < 10
    OR coalesce(NEW.row_count,0) >= ceil(OLD.row_count*0.6) THEN
  RETURN NEW;
 END IF;
 DELETE FROM public.cockpit_native_shrink_allowances WHERE table_name=NEW.table_name AND allow_until>now() RETURNING * INTO allowance;
 IF allowance.table_name IS NULL THEN
  RAISE EXCEPTION 'Refusing to publish csm.%: % rows would drop to %. Check the ClickUp client board. If it really shrank, run select cockpit_native_allow_shrink(''%'', ''why'') and let the next run publish.',
   NEW.table_name,OLD.row_count,coalesce(NEW.row_count,0),NEW.table_name USING ERRCODE='23514';
 END IF;
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_system,before,after,metadata)
 VALUES('SHRINK_ALLOWED','cockpit_csm_source_state',NEW.table_name,allowance.created_by,'supabase',
  jsonb_build_object('row_count',OLD.row_count),jsonb_build_object('row_count',NEW.row_count),jsonb_build_object('reason',allowance.reason));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_client_list_floor() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS cockpit_csm_client_list_floor ON public.cockpit_csm_source_state;
CREATE TRIGGER cockpit_csm_client_list_floor BEFORE UPDATE OF row_count ON public.cockpit_csm_source_state
 FOR EACH ROW WHEN (NEW.row_count IS DISTINCT FROM OLD.row_count)
 EXECUTE FUNCTION public.cockpit_csm_client_list_floor();
COMMIT;
