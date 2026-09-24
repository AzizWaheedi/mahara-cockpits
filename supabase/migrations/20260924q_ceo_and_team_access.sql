-- CEO, Team Meetings, and Management Access
-- Grants permissions and RLS policies for founder CEO and authenticated cockpit seats.
-- Creative Triage (bldgtotkfmhoxmlzowdx).

BEGIN;

-- 1. Helper function for active cockpit membership
CREATE OR REPLACE FUNCTION public.cockpit_has_active_seat()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.cockpit_members cm
    JOIN auth.users au ON au.id = cm.auth_user_id
    WHERE cm.auth_user_id = auth.uid()
      AND cm.active = true
      AND au.email_confirmed_at IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cockpit_has_active_seat() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_has_active_seat() TO authenticated, service_role;

-- 2. CEO Sections and Metrics
GRANT SELECT ON public.cockpit_sections TO authenticated;
GRANT SELECT ON public.cockpit_metric_definitions TO authenticated;
GRANT SELECT ON public.cockpit_metric_values TO authenticated;

DROP POLICY IF EXISTS cockpit_sections_select ON public.cockpit_sections;
CREATE POLICY cockpit_sections_select ON public.cockpit_sections
FOR SELECT TO authenticated
USING (public.cockpit_is_ceo());

DROP POLICY IF EXISTS cockpit_metric_definitions_select ON public.cockpit_metric_definitions;
CREATE POLICY cockpit_metric_definitions_select ON public.cockpit_metric_definitions
FOR SELECT TO authenticated
USING (public.cockpit_is_ceo());

DROP POLICY IF EXISTS cockpit_metric_values_select ON public.cockpit_metric_values;
CREATE POLICY cockpit_metric_values_select ON public.cockpit_metric_values
FOR SELECT TO authenticated
USING (public.cockpit_is_ceo());

-- 3. CEO Overview RPC
CREATE OR REPLACE FUNCTION public.cockpit_get_ceo_sections()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sections jsonb;
  v_day text;
  v_now bigint;
BEGIN
  IF NOT public.cockpit_is_ceo() THEN
    RAISE EXCEPTION 'Access denied: caller is not verified founder CEO';
  END IF;

  v_day := (now() AT TIME ZONE 'Asia/Kuwait')::date::text;
  v_now := (extract(epoch from now()) * 1000)::bigint;

  SELECT jsonb_object_agg(key, jsonb_build_object(
    'key', key,
    'label', label,
    'ok', ok,
    'error', error,
    'computedAt', (extract(epoch from computed_at) * 1000)::bigint,
    'lastOkAt', (extract(epoch from computed_at) * 1000)::bigint,
    'sources', coalesce(sources, '[]'::jsonb),
    'payload', payload
  ))
  INTO v_sections
  FROM public.cockpit_sections;

  RETURN jsonb_build_object(
    'day', v_day,
    'now', v_now,
    'sections', coalesce(v_sections, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cockpit_get_ceo_sections() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_get_ceo_sections() TO authenticated, service_role;

-- 4. Team Tables
GRANT SELECT, INSERT, UPDATE ON public.team_people TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_meetings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_meeting_people TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_sittings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_agenda TO authenticated;
GRANT SELECT, INSERT ON public.team_changes TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.team_agenda_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.team_changes_id_seq TO authenticated;

DROP POLICY IF EXISTS team_people_select ON public.team_people;
CREATE POLICY team_people_select ON public.team_people FOR SELECT TO authenticated
USING (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_meetings_all ON public.team_meetings;
CREATE POLICY team_meetings_all ON public.team_meetings FOR ALL TO authenticated
USING (public.cockpit_has_active_seat())
WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_meeting_people_all ON public.team_meeting_people;
CREATE POLICY team_meeting_people_all ON public.team_meeting_people FOR ALL TO authenticated
USING (public.cockpit_has_active_seat())
WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_sittings_all ON public.team_sittings;
CREATE POLICY team_sittings_all ON public.team_sittings FOR ALL TO authenticated
USING (public.cockpit_has_active_seat())
WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_agenda_all ON public.team_agenda;
CREATE POLICY team_agenda_all ON public.team_agenda FOR ALL TO authenticated
USING (public.cockpit_has_active_seat())
WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_changes_all ON public.team_changes;
CREATE POLICY team_changes_all ON public.team_changes FOR ALL TO authenticated
USING (public.cockpit_has_active_seat())
WITH CHECK (public.cockpit_has_active_seat());

-- 5. CEO Financial, Hiring, and Goal Tables
GRANT SELECT ON public.cockpit_bank_lines TO authenticated;
GRANT SELECT ON public.cockpit_statements TO authenticated;
GRANT SELECT ON public.cockpit_payer_clients TO authenticated;
GRANT SELECT ON public.cockpit_billing_accounts TO authenticated;
GRANT SELECT ON public.cockpit_payroll_months TO authenticated;
GRANT SELECT ON public.cockpit_people TO authenticated;
GRANT SELECT ON public.cockpit_hiring_candidates TO authenticated;
GRANT SELECT ON public.cockpit_hiring_applications TO authenticated;
GRANT SELECT ON public.cockpit_goal_plans TO authenticated;
GRANT SELECT ON public.cockpit_goal_targets TO authenticated;

DROP POLICY IF EXISTS cockpit_bank_lines_ceo ON public.cockpit_bank_lines;
CREATE POLICY cockpit_bank_lines_ceo ON public.cockpit_bank_lines FOR SELECT TO authenticated
USING (public.cockpit_is_ceo() OR public.cockpit_has_role('admin'));

DROP POLICY IF EXISTS cockpit_statements_ceo ON public.cockpit_statements;
CREATE POLICY cockpit_statements_ceo ON public.cockpit_statements FOR SELECT TO authenticated
USING (public.cockpit_is_ceo() OR public.cockpit_has_role('admin'));

DROP POLICY IF EXISTS cockpit_payer_clients_ceo ON public.cockpit_payer_clients;
CREATE POLICY cockpit_payer_clients_ceo ON public.cockpit_payer_clients FOR SELECT TO authenticated
USING (public.cockpit_is_ceo() OR public.cockpit_has_role('admin'));

DROP POLICY IF EXISTS cockpit_billing_accounts_ceo ON public.cockpit_billing_accounts;
CREATE POLICY cockpit_billing_accounts_ceo ON public.cockpit_billing_accounts FOR SELECT TO authenticated
USING (public.cockpit_is_ceo() OR public.cockpit_has_role('admin'));

DROP POLICY IF EXISTS cockpit_payroll_months_ceo ON public.cockpit_payroll_months;
CREATE POLICY cockpit_payroll_months_ceo ON public.cockpit_payroll_months FOR SELECT TO authenticated
USING (public.cockpit_is_ceo() OR public.cockpit_has_role('admin'));

DROP POLICY IF EXISTS cockpit_people_ceo ON public.cockpit_people;
CREATE POLICY cockpit_people_ceo ON public.cockpit_people FOR SELECT TO authenticated
USING (public.cockpit_is_ceo() OR public.cockpit_has_role('admin'));

DROP POLICY IF EXISTS cockpit_hiring_candidates_ceo ON public.cockpit_hiring_candidates;
CREATE POLICY cockpit_hiring_candidates_ceo ON public.cockpit_hiring_candidates FOR SELECT TO authenticated
USING (public.cockpit_is_ceo() OR public.cockpit_has_role('admin'));

DROP POLICY IF EXISTS cockpit_hiring_applications_ceo ON public.cockpit_hiring_applications;
CREATE POLICY cockpit_hiring_applications_ceo ON public.cockpit_hiring_applications FOR SELECT TO authenticated
USING (public.cockpit_is_ceo() OR public.cockpit_has_role('admin'));

DROP POLICY IF EXISTS cockpit_goal_plans_ceo ON public.cockpit_goal_plans;
CREATE POLICY cockpit_goal_plans_ceo ON public.cockpit_goal_plans FOR SELECT TO authenticated
USING (public.cockpit_is_ceo() OR public.cockpit_has_role('admin'));

DROP POLICY IF EXISTS cockpit_goal_targets_ceo ON public.cockpit_goal_targets;
CREATE POLICY cockpit_goal_targets_ceo ON public.cockpit_goal_targets FOR SELECT TO authenticated
USING (public.cockpit_is_ceo() OR public.cockpit_has_role('admin'));

COMMIT;
