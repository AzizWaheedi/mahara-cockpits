-- New reports belong to verified people; old ownerless rows remain legacy history.
BEGIN;
ALTER TABLE public.cockpit_eod_reports
 ADD COLUMN IF NOT EXISTS owner_user_id uuid,
 ADD COLUMN IF NOT EXISTS owner_email text,
 ADD COLUMN IF NOT EXISTS body text,
 ADD COLUMN IF NOT EXISTS stress numeric;
-- No auth-user cascade: deleting a login must not erase report ownership/history.
DROP INDEX IF EXISTS public.uq_cockpit_eod_role_day;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_eod_person_role_day ON public.cockpit_eod_reports(owner_user_id,role,day)
 WHERE owner_user_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.cockpit_eod_working_day(p_now timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ((p_now AT TIME ZONE 'Asia/Kuwait')-interval '4 hours')::date;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_eod_actor(p_role text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_role IS NULL OR p_role NOT IN ('media_buyer','csm','creative')
 OR (public.cockpit_has_role(p_role) OR public.cockpit_is_ceo()) IS NOT TRUE THEN
 RAISE EXCEPTION 'Active verified access to this cockpit is required' USING ERRCODE='42501';END IF;
 RETURN auth.uid();
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_personal_eod(p_role text,p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid;day_for date;report jsonb;
BEGIN
 uid:=public.cockpit_eod_actor(p_role);
 day_for:=coalesce(p_day,public.cockpit_eod_working_day(now()));
 IF day_for>public.cockpit_eod_working_day(now()) THEN RAISE EXCEPTION 'EOD day cannot be in the future';END IF;
 SELECT to_jsonb(r) INTO report FROM public.cockpit_eod_reports r
 WHERE r.owner_user_id=uid AND r.role=p_role AND r.day=day_for;
 RETURN jsonb_build_object('owner',uid,'day',day_for,'report',report,'delivery','not_configured');
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_save_personal_eod(p_role text,p_patch jsonb,p_expected_owner uuid,p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid;email text;day_for date;r public.cockpit_eod_reports;oldrow public.cockpit_eod_reports;
 fresh boolean;submit boolean;field text;rating numeric;
BEGIN
 uid:=public.cockpit_eod_actor(p_role);
 IF p_expected_owner IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Your session changed. Reload the report before saving' USING ERRCODE='42501';END IF;
 day_for:=coalesce(p_day,public.cockpit_eod_working_day(clock_timestamp()));
 IF day_for>public.cockpit_eod_working_day(clock_timestamp()) THEN RAISE EXCEPTION 'EOD day cannot be in the future';END IF;
 IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'EOD changes must be an object';END IF;
 FOR field IN SELECT jsonb_object_keys(p_patch) LOOP
 IF field NOT IN ('energy','stress','body','answers','computed','submit') THEN RAISE EXCEPTION 'Unsupported EOD field: %',field;END IF;END LOOP;
 IF p_patch ? 'submit' AND jsonb_typeof(p_patch->'submit') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Submit must be true or false';END IF;
 submit:=coalesce((p_patch->>'submit')::boolean,false);
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||p_role||day_for::text,0));
 SELECT * INTO r FROM public.cockpit_eod_reports WHERE owner_user_id=uid AND role=p_role AND day=day_for FOR UPDATE;
 fresh:=NOT FOUND;oldrow:=r;
 IF fresh THEN r.answers:='{}';r.computed:='{}';END IF;
 FOREACH field IN ARRAY ARRAY['energy','stress'] LOOP
 IF p_patch ? field THEN
   IF jsonb_typeof(p_patch->field) NOT IN ('number','string','null') THEN RAISE EXCEPTION 'Energy and stress must be numeric ratings';END IF;
   rating:=nullif(btrim(p_patch->>field),'')::numeric;
   IF rating<0 OR rating>10 THEN RAISE EXCEPTION 'Energy and stress must be between 0 and 10';END IF;
   IF field='energy' THEN r.energy:=rating;ELSE r.stress:=rating;END IF;
 END IF;END LOOP;
 FOREACH field IN ARRAY ARRAY['answers','computed'] LOOP
 IF p_patch ? field THEN
   IF jsonb_typeof(p_patch->field) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'EOD answers and computed values must be objects';END IF;
   IF field='answers' THEN r.answers:=r.answers||(p_patch->field);ELSE r.computed:=r.computed||(p_patch->field);END IF;
 END IF;END LOOP;
 IF p_patch ? 'body' THEN
 IF jsonb_typeof(p_patch->'body') NOT IN ('string','null') THEN RAISE EXCEPTION 'EOD body must be text';END IF;
 r.body:=p_patch->>'body';END IF;
 IF NOT fresh AND oldrow.submitted_at IS NOT NULL THEN
   IF ROW(r.energy,r.stress,r.answers,r.computed,r.body) IS DISTINCT FROM ROW(oldrow.energy,oldrow.stress,oldrow.answers,oldrow.computed,oldrow.body) THEN
     RAISE EXCEPTION 'This EOD was submitted and cannot be overwritten';
   END IF;
   RETURN public.cockpit_personal_eod(p_role,day_for);
 END IF;
 SELECT m.email INTO email FROM public.cockpit_members m WHERE m.auth_user_id=uid;
 IF fresh THEN
   INSERT INTO public.cockpit_eod_reports(owner_user_id,owner_email,role,day,energy,stress,answers,computed,body,submitted_at,source_system)
   VALUES(uid,email,p_role,day_for,r.energy,r.stress,r.answers,r.computed,r.body,CASE WHEN submit THEN clock_timestamp() END,'supabase');
 ELSE
   UPDATE public.cockpit_eod_reports SET energy=r.energy,stress=r.stress,answers=r.answers,computed=r.computed,body=r.body,
    submitted_at=CASE WHEN submit THEN clock_timestamp() END,updated_at=clock_timestamp() WHERE id=r.id;
 END IF;
 RETURN public.cockpit_personal_eod(p_role,day_for);
END;
$$;
CREATE OR REPLACE FUNCTION public.cockpit_eod_protect_submitted()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.owner_user_id IS NOT NULL AND
   (ROW(NEW.owner_user_id,NEW.owner_email,NEW.role,NEW.day) IS DISTINCT FROM ROW(OLD.owner_user_id,OLD.owner_email,OLD.role,OLD.day)
    OR (OLD.submitted_at IS NOT NULL AND ROW(NEW.energy,NEW.stress,NEW.answers,NEW.computed,NEW.body,NEW.submitted_at)
       IS DISTINCT FROM ROW(OLD.energy,OLD.stress,OLD.answers,OLD.computed,OLD.body,OLD.submitted_at))) THEN
   RAISE EXCEPTION 'Report ownership and submitted contents are immutable';
 END IF;RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cockpit_eod_protect_submitted ON public.cockpit_eod_reports;
CREATE TRIGGER cockpit_eod_protect_submitted BEFORE UPDATE ON public.cockpit_eod_reports FOR EACH ROW EXECUTE FUNCTION public.cockpit_eod_protect_submitted();
CREATE OR REPLACE FUNCTION public.cockpit_personal_eod_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text;
BEGIN
 SELECT m.email INTO actor FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
 WHERE m.auth_user_id=auth.uid() AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email));
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
 VALUES(CASE WHEN NEW.submitted_at IS NULL THEN 'eod.draft' ELSE 'eod.submitted' END,'cockpit_eod_reports',NEW.id::text,
 coalesce(actor,'service-role'),NEW.role,'supabase',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cockpit_personal_eod_audit ON public.cockpit_eod_reports;
CREATE TRIGGER cockpit_personal_eod_audit AFTER INSERT OR UPDATE ON public.cockpit_eod_reports FOR EACH ROW EXECUTE FUNCTION public.cockpit_personal_eod_audit();
CREATE OR REPLACE FUNCTION public.cockpit_legacy_eod_history(p_role text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF public.cockpit_is_ceo() IS NOT TRUE THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.day DESC,q.id DESC),'[]'::jsonb) INTO result
 FROM (SELECT * FROM public.cockpit_eod_reports WHERE owner_user_id IS NULL AND (p_role IS NULL OR role=p_role) ORDER BY day DESC,id DESC LIMIT 1000) q;
 RETURN result;
END;
$$;
ALTER TABLE public.cockpit_eod_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eod_reports_read_policy ON public.cockpit_eod_reports;
DROP POLICY IF EXISTS personal_eod_read ON public.cockpit_eod_reports;
CREATE POLICY personal_eod_read ON public.cockpit_eod_reports FOR SELECT TO authenticated
 USING(owner_user_id=auth.uid() AND (public.cockpit_has_role(role) OR public.cockpit_is_ceo()));
REVOKE ALL ON public.cockpit_eod_reports FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.cockpit_eod_reports TO service_role;
-- These obsolete definer RPCs have no active source callers after this migration.
-- The old summary reads all same-role reports and cannot safely serve the new model.
REVOKE ALL ON FUNCTION public.cockpit_save_eod(text,date,text,jsonb,jsonb),
 public.cockpit_get_dashboard_summary(text,date) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.cockpit_eod_actor(text),public.cockpit_eod_working_day(timestamptz),
 public.cockpit_eod_protect_submitted(),public.cockpit_personal_eod_audit() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_personal_eod(text,date),public.cockpit_save_personal_eod(text,jsonb,uuid,date),
 public.cockpit_legacy_eod_history(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_personal_eod(text,date),public.cockpit_save_personal_eod(text,jsonb,uuid,date),
 public.cockpit_legacy_eod_history(text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
