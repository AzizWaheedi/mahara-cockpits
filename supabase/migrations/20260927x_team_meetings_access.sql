-- Team Meetings Access & RLS for Authenticated Cockpit Members
-- Grants authenticated access to team_* tables gated strictly by cockpit_has_active_seat()
-- Creative Triage (bldgtotkfmhoxmlzowdx)

BEGIN;

-- 1. Ensure cockpit_has_active_seat() is available
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

REVOKE ALL ON FUNCTION public.cockpit_has_active_seat() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_has_active_seat() TO authenticated, service_role;

-- 2. Grants for all team tables
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.team_people,
  public.team_meetings,
  public.team_meeting_people,
  public.team_sittings,
  public.team_agenda,
  public.team_changes,
  public.team_meeting_blocks,
  public.team_wheels,
  public.team_wheel_options,
  public.team_wheel_spins,
  public.team_creative_rows,
  public.team_calendar_ops,
  public.team_meeting_series,
  public.team_recordings
TO authenticated;

GRANT ALL ON
  public.team_people,
  public.team_meetings,
  public.team_meeting_people,
  public.team_sittings,
  public.team_agenda,
  public.team_changes,
  public.team_meeting_blocks,
  public.team_wheels,
  public.team_wheel_options,
  public.team_wheel_spins,
  public.team_creative_rows,
  public.team_calendar_ops,
  public.team_meeting_series,
  public.team_recordings
TO service_role;

-- 3. Grants on sequences
DO $$
BEGIN
  IF to_regclass('public.team_agenda_id_seq') IS NOT NULL THEN
    GRANT USAGE, SELECT ON SEQUENCE public.team_agenda_id_seq TO authenticated, service_role;
  END IF;
  IF to_regclass('public.team_changes_id_seq') IS NOT NULL THEN
    GRANT USAGE, SELECT ON SEQUENCE public.team_changes_id_seq TO authenticated, service_role;
  END IF;
  IF to_regclass('public.team_meeting_blocks_id_seq') IS NOT NULL THEN
    GRANT USAGE, SELECT ON SEQUENCE public.team_meeting_blocks_id_seq TO authenticated, service_role;
  END IF;
  IF to_regclass('public.team_wheel_options_id_seq') IS NOT NULL THEN
    GRANT USAGE, SELECT ON SEQUENCE public.team_wheel_options_id_seq TO authenticated, service_role;
  END IF;
  IF to_regclass('public.team_wheel_spins_id_seq') IS NOT NULL THEN
    GRANT USAGE, SELECT ON SEQUENCE public.team_wheel_spins_id_seq TO authenticated, service_role;
  END IF;
  IF to_regclass('public.team_creative_rows_id_seq') IS NOT NULL THEN
    GRANT USAGE, SELECT ON SEQUENCE public.team_creative_rows_id_seq TO authenticated, service_role;
  END IF;
  IF to_regclass('public.team_calendar_ops_id_seq') IS NOT NULL THEN
    GRANT USAGE, SELECT ON SEQUENCE public.team_calendar_ops_id_seq TO authenticated, service_role;
  END IF;
  IF to_regclass('public.team_recordings_id_seq') IS NOT NULL THEN
    GRANT USAGE, SELECT ON SEQUENCE public.team_recordings_id_seq TO authenticated, service_role;
  END IF;
END $$;

-- 4. Enable RLS and assign policies
ALTER TABLE public.team_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_meeting_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_sittings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_agenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_meeting_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_wheels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_wheel_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_wheel_spins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_creative_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_calendar_ops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_meeting_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_recordings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_people_all ON public.team_people;
CREATE POLICY team_people_all ON public.team_people FOR ALL TO authenticated
USING (public.cockpit_has_active_seat()) WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_meetings_all ON public.team_meetings;
CREATE POLICY team_meetings_all ON public.team_meetings FOR ALL TO authenticated
USING (public.cockpit_has_active_seat()) WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_meeting_people_all ON public.team_meeting_people;
CREATE POLICY team_meeting_people_all ON public.team_meeting_people FOR ALL TO authenticated
USING (public.cockpit_has_active_seat()) WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_sittings_all ON public.team_sittings;
CREATE POLICY team_sittings_all ON public.team_sittings FOR ALL TO authenticated
USING (public.cockpit_has_active_seat()) WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_agenda_all ON public.team_agenda;
CREATE POLICY team_agenda_all ON public.team_agenda FOR ALL TO authenticated
USING (public.cockpit_has_active_seat()) WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_changes_all ON public.team_changes;
CREATE POLICY team_changes_all ON public.team_changes FOR ALL TO authenticated
USING (public.cockpit_has_active_seat()) WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_meeting_blocks_all ON public.team_meeting_blocks;
CREATE POLICY team_meeting_blocks_all ON public.team_meeting_blocks FOR ALL TO authenticated
USING (public.cockpit_has_active_seat()) WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_wheels_all ON public.team_wheels;
CREATE POLICY team_wheels_all ON public.team_wheels FOR ALL TO authenticated
USING (public.cockpit_has_active_seat()) WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_wheel_options_all ON public.team_wheel_options;
CREATE POLICY team_wheel_options_all ON public.team_wheel_options FOR ALL TO authenticated
USING (public.cockpit_has_active_seat()) WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_wheel_spins_all ON public.team_wheel_spins;
CREATE POLICY team_wheel_spins_all ON public.team_wheel_spins FOR ALL TO authenticated
USING (public.cockpit_has_active_seat()) WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_creative_rows_all ON public.team_creative_rows;
CREATE POLICY team_creative_rows_all ON public.team_creative_rows FOR ALL TO authenticated
USING (public.cockpit_has_active_seat()) WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_calendar_ops_all ON public.team_calendar_ops;
CREATE POLICY team_calendar_ops_all ON public.team_calendar_ops FOR ALL TO authenticated
USING (public.cockpit_has_active_seat()) WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_meeting_series_all ON public.team_meeting_series;
CREATE POLICY team_meeting_series_all ON public.team_meeting_series FOR ALL TO authenticated
USING (public.cockpit_has_active_seat()) WITH CHECK (public.cockpit_has_active_seat());

DROP POLICY IF EXISTS team_recordings_all ON public.team_recordings;
CREATE POLICY team_recordings_all ON public.team_recordings FOR ALL TO authenticated
USING (public.cockpit_has_active_seat()) WITH CHECK (public.cockpit_has_active_seat());

COMMIT;
