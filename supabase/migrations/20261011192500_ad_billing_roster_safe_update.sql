-- Hosted Supabase enables safeupdate: the roster replacement needs an explicit predicate.
CREATE OR REPLACE FUNCTION public.cockpit_ad_billing_roster_refresh(p_lease uuid,p_rows jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.cockpit_ad_billing_config WHERE lease=p_lease AND lease_until>now() FOR SHARE;
 IF NOT FOUND OR jsonb_typeof(p_rows)<>'array' THEN RAISE EXCEPTION 'Valid roster and monitor lease required'; END IF;
 DELETE FROM public.cockpit_ad_billing_roster WHERE client_task_id IS NOT NULL;
 INSERT INTO public.cockpit_ad_billing_roster(client_task_id,client_name)
 SELECT x.id,x.name FROM jsonb_to_recordset(p_rows) x(id text,name text);
END $$;
