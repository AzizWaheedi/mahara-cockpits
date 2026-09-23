-- The webinar funnel's own raw rows, 2026-09-23.
--
-- Aziz, 2026-09-23: "we will collect the rest of the metrics use composio we
-- have zoom api. qualification in the form after also before they book a
-- call". The Live Training tracking brief (6 August 2026) names Zoom as the
-- source of truth for who showed and for how long, and Typeform for the
-- post-event form. The worker `hermes/webinar-pull` reads both, through
-- Composio first, and writes only here; the CEO cockpit's webinar section
-- reads these rows next to the B2B registrants and computes every rate on
-- read. The brief's rule: raw rows are kept as they came, never a rate,
-- "because the definitions will change at least twice".
--
-- 1. cockpit_webinar_sessions    one row per Zoom meeting instance that ran
-- 2. cockpit_webinar_attendance  one row per join/leave pair (people rejoin;
--                                one row per person breaks the retention curve)
-- 3. cockpit_webinar_engagement  chat lines, poll answers, Q&A, pitch clicks
-- 4. cockpit_webinar_forms       the post-event survey's responses (Typeform)
-- 5. cockpit_webinar_pulls       every run of the worker, for the health line
--
-- Service key only, like every cockpit_ table: the worker writes with it and
-- the cockpit reads with the management token.

begin;

create table if not exists public.cockpit_webinar_sessions (
  uuid              text primary key,
  meeting_id        text not null,
  topic             text,
  started_at        timestamptz not null,
  ended_at          timestamptz,
  duration_min      integer,
  host_email        text,
  -- Pitch times set by hand in the cockpit. Empty means the cockpit finds
  -- pitch 1 from the chat ("drop a 1"); the worker never writes these.
  pitch1_at         timestamptz,
  pitch2_at         timestamptz,
  pitch_set_by      text,
  pitch_set_at      timestamptz,
  recording_files   text[] not null default '{}',
  participant_rows  integer not null default 0,
  chat_rows         integer not null default 0,
  poll_rows         integer not null default 0,
  complete          boolean not null default false,
  pulled_at         timestamptz,
  created_at        timestamptz not null default now()
);
comment on table public.cockpit_webinar_sessions is
  'One row per Zoom meeting instance of the live training (the instance UUID). complete once the session has ended, every participant page and the recording chat were read.';
create index if not exists cockpit_webinar_sessions_started
  on public.cockpit_webinar_sessions (started_at desc);

create table if not exists public.cockpit_webinar_attendance (
  id              bigserial primary key,
  session_uuid    text not null references public.cockpit_webinar_sessions (uuid) on delete cascade,
  row_key         text not null,
  -- Who this is, for counting people once: reg:<registrant id>,
  -- zoom:<participant id> (signed-in users), email:<address>, or
  -- name:<display name> for a guest with nothing else. Only the first three
  -- are ever used to join a person to a HighLevel contact.
  person_key      text not null,
  name            text,
  email           text,
  registrant_id   text,
  participant_id  text,
  zoom_user_id    text,
  contact_id      text,
  status          text not null default 'in_meeting',
  internal        boolean not null default false,
  join_at         timestamptz not null,
  leave_at        timestamptz,
  seconds         integer,
  failover        boolean not null default false,
  pulled_at       timestamptz not null default now(),
  unique (session_uuid, row_key)
);
comment on table public.cockpit_webinar_attendance is
  'Zoom past-meeting participants, one row per join/leave pair as Zoom returns them. status in_waiting_room rows never count as attendance; internal marks our own people.';
create index if not exists cockpit_webinar_attendance_session
  on public.cockpit_webinar_attendance (session_uuid, join_at);
create index if not exists cockpit_webinar_attendance_email
  on public.cockpit_webinar_attendance (email) where email is not null;

create table if not exists public.cockpit_webinar_engagement (
  id            bigserial primary key,
  session_uuid  text references public.cockpit_webinar_sessions (uuid) on delete cascade,
  kind          text not null check (kind in ('chat', 'poll', 'qa', 'cta_click')),
  row_key       text not null,
  at            timestamptz,
  offset_s      integer,
  person_key    text,
  name          text,
  email         text,
  contact_id    text,
  pitch_number  smallint,
  body          text,
  payload       jsonb,
  pulled_at     timestamptz not null default now(),
  unique (kind, row_key)
);
comment on table public.cockpit_webinar_engagement is
  'What people did in the room: chat lines from the recording chat file (offset_s from the recording start), poll answers and Q&A from the Zoom app, pitch link clicks.';
create index if not exists cockpit_webinar_engagement_session
  on public.cockpit_webinar_engagement (session_uuid, kind, at);

create table if not exists public.cockpit_webinar_forms (
  response_id   text primary key,
  form_id       text not null,
  submitted_at  timestamptz not null,
  landed_at     timestamptz,
  email         text,
  phone         text,
  contact_id    text,
  name          text,
  -- The survey's own words, and the lower bound of the profit band in US
  -- dollars (0 for "under $100,000") so a threshold is a comparison.
  profit_band   text,
  profit_min    numeric,
  years_band    text,
  work_type     text,
  blocker       text,
  goal_band     text,
  success       text,
  hidden        jsonb,
  answers       jsonb not null default '[]'::jsonb,
  pulled_at     timestamptz not null default now()
);
comment on table public.cockpit_webinar_forms is
  'Responses to the live training gift survey (Typeform P1xP4r24), on the thank-you page and after the session. Matched to a registrant by contact id, email, then phone; never by name.';
create index if not exists cockpit_webinar_forms_email
  on public.cockpit_webinar_forms (email) where email is not null;
create index if not exists cockpit_webinar_forms_submitted
  on public.cockpit_webinar_forms (submitted_at desc);

create table if not exists public.cockpit_webinar_pulls (
  id           bigserial primary key,
  source       text not null check (source in ('zoom', 'typeform')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  via          text,
  detail       text,
  counts       jsonb
);
comment on table public.cockpit_webinar_pulls is
  'Every run of hermes/webinar-pull, per source. The cockpit says when the last good read was and what the last error said.';
create index if not exists cockpit_webinar_pulls_recent
  on public.cockpit_webinar_pulls (source, started_at desc);

alter table public.cockpit_webinar_sessions   enable row level security;
alter table public.cockpit_webinar_attendance enable row level security;
alter table public.cockpit_webinar_engagement enable row level security;
alter table public.cockpit_webinar_forms      enable row level security;
alter table public.cockpit_webinar_pulls      enable row level security;

revoke all on public.cockpit_webinar_sessions   from anon, authenticated;
revoke all on public.cockpit_webinar_attendance from anon, authenticated;
revoke all on public.cockpit_webinar_engagement from anon, authenticated;
revoke all on public.cockpit_webinar_forms      from anon, authenticated;
revoke all on public.cockpit_webinar_pulls      from anon, authenticated;
revoke all on sequence public.cockpit_webinar_attendance_id_seq from anon, authenticated;
revoke all on sequence public.cockpit_webinar_engagement_id_seq from anon, authenticated;
revoke all on sequence public.cockpit_webinar_pulls_id_seq      from anon, authenticated;

grant all on public.cockpit_webinar_sessions   to service_role;
grant all on public.cockpit_webinar_attendance to service_role;
grant all on public.cockpit_webinar_engagement to service_role;
grant all on public.cockpit_webinar_forms      to service_role;
grant all on public.cockpit_webinar_pulls      to service_role;
grant usage, select on sequence public.cockpit_webinar_attendance_id_seq to service_role;
grant usage, select on sequence public.cockpit_webinar_engagement_id_seq to service_role;
grant usage, select on sequence public.cockpit_webinar_pulls_id_seq      to service_role;

commit;
