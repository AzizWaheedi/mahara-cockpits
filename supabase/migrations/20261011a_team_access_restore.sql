-- Restore team_* table access for signed-in cockpit seats.
--
-- Incident 2026-10-11: every public.team_* table had row security ON but no
-- policies and no grant to `authenticated`, so the Team Meetings page failed
-- with "permission denied for table team_people". The guard and audit
-- triggers from 20261004b were still present; only grants and policies were gone.
--
-- This re-applies exactly the access model of 20261004b_team_native_security:
--   * every team table: SELECT for authenticated, gated by cockpit_has_active_seat()
--   * browser-writable tables only: INSERT/UPDATE/DELETE gated by the same seat check
--   * roster, series, recordings, calendar ops and meeting people stay command-only
--     (team_native_guard trigger rejects direct writes; commands are SECURITY DEFINER)
--   * team_changes stays insert-only (immutable audit)
-- Idempotent. It does not touch triggers or data.
begin;

do $$
declare
  t text;
  p record;
  writable text[] := array['team_meetings','team_sittings','team_agenda','team_meeting_blocks',
                           'team_wheels','team_wheel_options','team_creative_rows','team_changes'];
begin
  foreach t in array array['team_people','team_meetings','team_meeting_people','team_sittings','team_agenda',
                           'team_changes','team_meeting_blocks','team_wheels','team_wheel_options','team_wheel_spins',
                           'team_creative_rows','team_calendar_ops','team_meeting_series','team_recordings'] loop
    if to_regclass('public.'||t) is null then continue; end if;
    for p in select policyname from pg_policies where schemaname='public' and tablename=t
             and policyname in ('team_native_read','team_native_write') loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy team_native_read on public.%I for select to authenticated using (public.cockpit_has_active_seat())', t);
    if t = any(writable) then
      execute format('grant insert, update, delete on public.%I to authenticated', t);
      execute format('create policy team_native_write on public.%I for all to authenticated using (public.cockpit_has_active_seat()) with check (public.cockpit_has_active_seat())', t);
    end if;
  end loop;
end $$;

revoke update, delete on public.team_changes from authenticated;

do $$
declare s text;
begin
  foreach s in array array['team_agenda_id_seq','team_changes_id_seq','team_meeting_blocks_id_seq',
                           'team_wheel_options_id_seq','team_wheel_spins_id_seq','team_creative_rows_id_seq',
                           'team_calendar_ops_id_seq','team_recordings_id_seq'] loop
    if to_regclass('public.'||s) is not null then
      execute format('grant usage, select on sequence public.%I to authenticated, service_role', s);
    end if;
  end loop;
end $$;

commit;
