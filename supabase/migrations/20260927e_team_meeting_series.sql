-- A meeting can be several Google Calendar series, 2026-09-27.
--
-- The CEO's calendar holds the v5 week as one series per day where the day
-- has its own theme: CSM Daily is five weekly series (Projections, Game
-- Tape, Role Play, Strategy, Wrap) and Call Center three (Kickoff + Call
-- Review, Role Play, Wrap + Prize Wheel), each titled for its day. One
-- cockpit meeting owns all of them: its run of show, wheels and notes are
-- one meeting's, and its sittings come from every day's series.
--
-- team_meetings.cal_calendar and cal_event_id stay the meeting's main
-- series (20260927d_team_meetings_v5.sql). This table lists every series a
-- meeting is linked to, the main one included: one row with no weekday for
-- a meeting that is a single series, one row per day for one that is a
-- series a day. The cockpit writes a change to each of them
-- (convex/teamCalendar.ts); hermes/team-sync keeps each row as Google has it.

create table if not exists public.team_meeting_series (
  meeting_id    text not null references public.team_meetings (id) on delete cascade,
  cal_calendar  text not null,
  cal_event_id  text not null,
  -- The one day this series covers; null when it covers all the meeting's days.
  weekday       smallint check (weekday is null or weekday between 0 and 6),
  cal_title     text,
  cal_etag      text,
  rrule         text,
  start_time    time,
  minutes       integer,
  meet_link     text,
  ends_on       date,
  cal_writable  boolean not null default false,
  updated_at    timestamptz not null default now(),
  primary key (cal_calendar, cal_event_id)
);
create index if not exists team_meeting_series_meeting on public.team_meeting_series (meeting_id, weekday);

alter table public.team_meeting_series enable row level security;
revoke all on public.team_meeting_series from anon, authenticated;
grant all on public.team_meeting_series to service_role;
