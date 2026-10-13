-- The team meetings screen (portal /team), 2026-09-23.
--
-- Aziz, 2026-09-22: "a doc and an agenda for each meeting ... everybody can
-- edit it the same way it would be for a Google Doc", and people assigned,
-- invited and made hosts "straight from there". Three additions to
-- 20260922b_team_meetings.sql:
--
-- 1. The living doc of a meeting: the end-of-month projections doc, updated
--    at every sitting. It carries a version, and a save that started from an
--    older version is refused, so two people writing at once never silently
--    overwrite each other. Sitting notes get the same version.
-- 2. What was decided in the cockpit. The hourly calendar sync
--    (hermes/team-sync) rewrote the host, department and cadence and reset
--    every person's part from the invite. A meeting edited in the cockpit is
--    now `managed = 'cockpit'` and a person row `source = 'cockpit'`; the sync
--    leaves both alone. A person taken off in the cockpit is kept as
--    `removed`, so the next sync cannot put them back from the invite.
-- 3. A change log: every write from the screen, who and what.

alter table public.team_meetings
  add column if not exists doc          text,
  add column if not exists doc_by       text,
  add column if not exists doc_at       timestamptz,
  add column if not exists doc_version  integer not null default 0,
  add column if not exists managed      text not null default 'calendar';
alter table public.team_meetings drop constraint if exists team_meetings_managed_check;
alter table public.team_meetings
  add constraint team_meetings_managed_check check (managed in ('calendar', 'cockpit'));

alter table public.team_meeting_people
  add column if not exists source      text not null default 'calendar',
  add column if not exists removed     boolean not null default false,
  add column if not exists changed_by  text,
  add column if not exists changed_at  timestamptz;
alter table public.team_meeting_people drop constraint if exists team_meeting_people_source_check;
alter table public.team_meeting_people
  add constraint team_meeting_people_source_check check (source in ('calendar', 'cockpit'));

alter table public.team_sittings
  add column if not exists notes_version integer not null default 0;

create table if not exists public.team_changes (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  by_whom     text not null,
  meeting_id  text,
  what        text not null,
  detail      jsonb
);
create index if not exists team_changes_meeting on public.team_changes (meeting_id, at desc);

alter table public.team_changes enable row level security;
revoke all on public.team_changes from anon, authenticated;
grant all on public.team_changes to service_role;
revoke all on sequence public.team_changes_id_seq from anon, authenticated;
grant usage, select on sequence public.team_changes_id_seq to service_role;
